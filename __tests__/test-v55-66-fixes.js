// ============================================================
// v55.66 — Performance gating + MyHRDesk persistence + Shipping list view
//
// Fixes from Max May 7 2026:
//   1. Performance Coach data should be admin/super_admin ONLY (regular
//      team members should not see scoring, ranking, coach reports).
//   2. MyHRDesk must NOT disappear after first load — needs to be
//      visible permanently and prominently.
//   3. Restore the "list" sub-view in Shipping Rates that used to exist
//      and is now missing.
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label, detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.66 — Performance gating + HRDesk persistence + List view');
console.log('============================================================');

// ============================================================
// 1. MyPerformance gated to admin/super_admin only
// ============================================================
group('1. Performance Coach gating — REVERTED in v55.67');

var pd = read('src/components/PersonalDashboard.jsx');
// v55.67 superseded v55.66 here: Max corrected that Performance Coach
// should be visible to ALL users (only the team-wide HR Report stays
// admin-gated). These tests now verify the v55.67 state.
check('1.1 PersonalDashboard signature still accepts isSuperAdmin (kept for other flags)',
  /isSuperAdmin/.test((pd.match(/export default function PersonalDashboard\(\{[^}]*\}/) || [''])[0]));
check('1.2 v55.71 — MyPerformance is NOT gated on isAdmin/isSuperAdmin (now lives in AssistantsBar Sara panel)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return !/\(isAdmin \|\| isSuperAdmin\) && \([\s\S]{0,200}<MyPerformance/.test(ab)
      && !/\(isAdmin \|\| isSuperAdmin\) && \([\s\S]{0,200}<Tile[\s\S]{0,200}who="sara"/.test(ab);
  })());
check('1.3 v55.71 — MyPerformance renders unconditionally for everyone (inside AssistantsBar Sara panel)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return /openPanel === 'sara'[\s\S]{0,1500}<MyPerformance/.test(ab);
  })());

var pg = read('src/app/page.jsx');
check('1.4 page.jsx still passes isSuperAdmin to PersonalDashboard (kept for future use)',
  /<PersonalDashboard [^>]*isSuperAdmin=\{isSuperAdmin\}/.test(pg));

// ============================================================
// 2. MyHRDesk persistence — never disappears
// ============================================================
group('2. MyHRDesk renders prominently AND never disappears');

check('2.1 v55.71 — MyHRDesk imported by AssistantsBar (not PersonalDashboard)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return /import MyHRDesk from '\.\/MyHRDesk'/.test(ab) && !/import MyHRDesk from '\.\/MyHRDesk'/.test(pd);
  })());
check('2.2 v55.71 SUPERSEDES — exactly one MyHRDesk mount (inside AssistantsBar), zero in dashboard',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return (pd.match(/<MyHRDesk /g) || []).length === 0
      && (ab.match(/<MyHRDesk /g) || []).length === 1
      && !/const HRDeskBlock = /.test(pd);
  })());
check('2.3 v55.68 SUPERSEDES — no early-return tree (was the disappearance cause)',
  !/if \(!loaded\) return \(/.test(pd));
check('2.4 v55.71 SUPERSEDES — MyHRDesk now mounts inside AssistantsBar Jenna panel',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk/.test(ab);
  })());
check('2.5 v55.71 SUPERSEDES — MyHRDesk + MyPerformance now ordered inside AssistantsBar (Jenna panel before Sara panel)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return ab.indexOf('<MyHRDesk') < ab.indexOf('<MyPerformance');
  })());
check('2.6 dashboard load uses INDEPENDENT try/catch per query (not Promise.all)',
  // No Promise.all wrapping the main fetches anymore in load()
  !/const \[t, e, fu\] = await Promise\.all/.test(pd),
  'Promise.all is fragile — one rejection blanks the whole dashboard');
check('2.7 setLoaded(true) ALWAYS fires (outside any try/catch)',
  // Find the load function and ensure setLoaded(true) is at the top level
  /if \(!cancelled\) setLoaded\(true\)/.test(pd));
check('2.8 dashboard cancellation guard prevents stale setState',
  /let cancelled = false[\s\S]{0,2000}return \(\) => \{ cancelled = true; \}/.test(pd));

// ============================================================
// 3. Shipping Rates list view restored
// ============================================================
group('3. Shipping Rates — list view restored');

var srt = read('src/components/ShippingRatesTab.jsx');
check('3.1 routesViewMode state added with localStorage persistence',
  /\[routesViewMode, setRoutesViewMode\][\s\S]{0,300}localStorage\.getItem\('ktc_shipping_routes_view_mode'\)/.test(srt));
check('3.2 setRoutesViewModePersist saves to localStorage on toggle',
  /window\.localStorage\.setItem\('ktc_shipping_routes_view_mode', mode\)/.test(srt));
check('3.3 view-mode toggle UI (🗂 Routes vs 📋 List pills)',
  /🗂 Routes/.test(srt) && /📋 List/.test(srt));
check('3.4 Routes view conditional render (routesViewMode === routes)',
  /routesViewMode === 'routes' && \(/.test(srt));
check('3.5 List view conditional render (routesViewMode === list)',
  /routesViewMode === 'list' && \(/.test(srt));
check('3.6 List view shows ALL filtered rates (not grouped)',
  /filtered\.slice\(\)\.sort/.test(srt));
check('3.7 List has sortable columns (clickable headers)',
  /\[listSortKey, setListSortKey\]/.test(srt) && /onClick=\{function \(\) \{[\s\S]{0,200}setListSortKey/.test(srt));
check('3.8 List shows ETD / Origin / Dest / POL / POD / Vendor / Line / TT / FT / Rate / Expires',
  /'effective_date'[\s\S]{0,80}'origin'[\s\S]{0,80}'destination'[\s\S]{0,80}'port_of_loading'[\s\S]{0,80}'port_of_discharge'[\s\S]{0,80}'vendor_name'[\s\S]{0,80}'shipping_line'[\s\S]{0,80}'container_type'[\s\S]{0,80}'transit_days'[\s\S]{0,80}'free_days'[\s\S]{0,80}'rate_amount'[\s\S]{0,80}'expiry_date'/.test(srt));
check('3.9 List row click navigates to route_detail (same as card click)',
  /setSelectedRoute\(\{origin: r\.origin, destination: r\.destination, pol: r\.port_of_loading[\s\S]{0,200}setView\('route_detail'\)/.test(srt));
check('3.10 List has inline edit button per row',
  /onClick=\{function \(e\) \{ e\.stopPropagation\(\); setEditingRate\(r\)/.test(srt));
check('3.11 Expired rates dimmed (opacity-60) but still visible in list',
  /exp \? 'opacity-60' : ''/.test(srt));
check('3.12 Detail Line View respects ALL existing filters (filtered, not raw)',
  /📋 Detail Line View \(\{filtered\.length\}\)/.test(srt));
check('3.13 Routes (card) view STILL preserved as default',
  /routesViewMode === 'routes' && \([\s\S]{0,4000}routeGroups\.map/.test(srt));

// ============================================================
// 4. Carry-forward — earlier v55.65 work intact
// ============================================================
group('4. Carry-forward — v55.62/63/64/65 still intact');

check('4.1 v55.65 MyHRDesk component still present',
  fs.existsSync(path.join(REPO, 'src/components/MyHRDesk.jsx')));
check('4.2 v55.65 AdminHRInbox component still present',
  fs.existsSync(path.join(REPO, 'src/components/AdminHRInbox.jsx')));
check('4.3 v55.65 SQL files still present',
  fs.existsSync(path.join(REPO, 'sql/s40_system_tickets_retest.sql'))
  && fs.existsSync(path.join(REPO, 'sql/s41_hr_desk_requests_complaints.sql')));

var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('4.4 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));

var ag = read('src/components/AIGreeter.jsx');
check('4.5 Nadia anti-repetition still wired', /nadia_recent_phrases/.test(ag));
check('4.6 Nadia "DO NOT REPEAT YOURSELF" prompt still injected', /DO NOT REPEAT YOURSELF/.test(ag));

check('4.7 Nadia loading-screen pill still present', /Nadia is here/.test(pg));

var stp = read('src/components/SystemTicketsPanel.jsx');
check('4.8 SystemTickets fix-in-build still wired', /openFixModal/.test(stp));
check('4.9 SystemTickets retest still wired', /openRetestModal/.test(stp));

var mp = read('src/components/MyPerformance.jsx');
check('4.10 MyPerformance default-expanded still set', /useState\(true\); \/\/ map of version|const \[expanded, setExpanded\] = useState\(true\)/.test(mp));
check('4.11 MyPerformance SVG logo still present', /viewBox="0 0 44 44"/.test(mp));

check('4.12 Shipping POL/POD filters still work', /filterPol/.test(srt) && /filterPod/.test(srt));

var ct = read('src/components/CustomsTab.jsx');
check('4.13 v55.64 Customs Excel import still present', /TEMPLATE_COLUMNS/.test(ct));

// ============================================================
// 5. Edge cases
// ============================================================
group('5. Edge cases');

check('5.1 list-view sort is stable for null values',
  /if \(av == null && bv == null\) return 0;[\s\S]{0,100}if \(av == null\) return 1;[\s\S]{0,100}if \(bv == null\) return -1/.test(srt));
check('5.2 list-view sort handles numbers vs strings',
  /typeof av === 'number' && typeof bv === 'number'/.test(srt));
check('5.3 routesViewMode reads localStorage SAFELY (try/catch + window check)',
  /try \{ return \(typeof window !== 'undefined' && window\.localStorage\.getItem\('ktc_shipping_routes_view_mode'\)\)/.test(srt));
check('5.4 dashboard load never throws — every query has its own try/catch',
  // count try blocks in load function
  (function () {
    var loadFn = pd.match(/const load = async \(\) => \{[\s\S]*?\n    \};/);
    if (!loadFn) return false;
    var tryCount = (loadFn[0].match(/try \{/g) || []).length;
    return tryCount >= 5; // 5 queries: tickets, events, follow_ups, reminders, system_tickets
  })());
check('5.5 v55.71 SUPERSEDES — MyHRDesk now mounts inside AssistantsBar (zero direct dashboard mounts)',
  // v55.71 moved MyHRDesk inside the Jenna panel of AssistantsBar.
  // PersonalDashboard no longer mounts it directly. New invariant:
  // zero direct MyHRDesk mounts in dashboard, exactly one in AssistantsBar.
  (pd.match(/<MyHRDesk /g) || []).length === 0
  && !/if \(!loaded\) return \(/.test(pd));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); if (f.detail) console.log('     ' + f.detail); });
  process.exit(1);
}
console.log('\n✅ All ' + passed + ' tests passed');
