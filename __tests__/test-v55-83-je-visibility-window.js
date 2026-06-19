// ============================================================
// v55.83-JE — ADMIN HISTORY-VISIBILITY WINDOW. Super-admin sets how far back normal users may see
// history; super-admins always see all. Pure-logic runtime tests + wiring assertions.
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

// --- A. Pure window math (runtime) ---
var vw = require('../src/lib/visibility-window.js');
var NOW = new Date('2026-06-19T12:00:00Z');
ok('A1: super-admin always gets a null floor (sees all)', vw.floorDateFor({ window: '1m', isSuperAdmin: true }, NOW) === null);
ok('A2: "all" window = null floor', vw.floorDateFor({ window: 'all' }, NOW) === null);
ok('A3: current-year floor is Jan 1 of this year', vw.floorDateFor({ window: 'cy' }, NOW) === '2026-01-01');
ok('A4: 1-month window is 30 days back', vw.floorDateFor({ window: '1m' }, NOW) === '2026-05-20');
ok('A5: 1-year window is 365 days back', vw.floorDateFor({ window: '1y' }, NOW) === '2025-06-19');
ok('A6: custom days back', vw.floorDateFor({ window: 'custom', customDays: 10 }, NOW) === '2026-06-09');
ok('A7: custom explicit from-date wins', vw.floorDateFor({ window: 'custom', customFrom: '2026-03-01' }, NOW) === '2026-03-01');
ok('A8: unknown window key falls back to all (null)', vw.floorDateFor({ window: 'bogus' }, NOW) === null);
ok('A9: isWithinWindow respects the floor', vw.isWithinWindow('2026-06-15', '2026-06-01') === true && vw.isWithinWindow('2026-05-01', '2026-06-01') === false && vw.isWithinWindow('2026-05-01', null) === true);
ok('A10: labelForWindow describes custom days', /custom/.test(vw.labelForWindow('custom', 45)) && vw.labelForWindow('1y') === 'Last 1 year');

// --- B. Service-role route + super-admin gate ---
var route = rd('src/app/api/admin/visibility/route.js');
ok('B1: route is service-role + super-admin gated on write',
  /SUPABASE_SERVICE_ROLE_KEY/.test(route) && /urow\.role === 'super_admin'/.test(route) && /Only a super admin can change the history-visibility window/.test(route));
ok('B2: route degrades gracefully when the settings table is missing',
  /table_missing/.test(route) && /v55-83-JE-visibility-window\.sql/.test(route));
ok('B3: GET returns the current value, POST validates the window key',
  /export async function GET/.test(route) && /isValidWindowKey\(win\)/.test(route));

// --- C. Wiring: Bank Review + BankTab clamp the query and show the window ---
var br = rd('src/components/BankReviewTab.jsx');
ok('C1: BankReviewTab fetches the policy + clamps posted_date for non-super-admins',
  /fetch\('\/api\/admin\/visibility'\)/.test(br) && /if \(_floor\) \{ _txQRev = _txQRev\.gte\('posted_date', _floor\)/.test(br));
ok('C2: BankReviewTab shows a Visibility chip + newest-loaded date',
  /Newest loaded:/.test(br) && /Visibility:/.test(br) && /labelForWindow\(visCfg\.window, visCfg\.customDays\)/.test(br));
var bt = rd('src/components/BankTab.jsx');
ok('C3: BankTab clamps its query + shows the window',
  /if \(_visFloor\) \{ _txq = _txq\.gte\('posted_date', _visFloor\)/.test(bt) && /Visibility:/.test(bt));

// --- D. Super-admin settings UI is mounted ---
var st = rd('src/components/SettingsTab.jsx');
ok('D1: SettingsTab mounts AccountingVisibilityPanel for super-admins',
  /AccountingVisibilityPanel/.test(st) && /'accountingvis'/.test(st));
var panel = rd('src/components/AccountingVisibilityPanel.jsx');
ok('D2: panel reads + writes via /api/admin/visibility',
  /fetch\('\/api\/admin\/visibility'\)/.test(panel) && /method: 'POST'/.test(panel));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JE visibility-window tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
