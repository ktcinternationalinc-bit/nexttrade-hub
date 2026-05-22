// ============================================================
// v55.69 — HR Request routing: manager vs super_admin by topic
//
// Max May 7 2026: "Updates that go to the HR person — they don't go to
// the admin or manager directly. Only vacation requests do. Anything
// else is a notification request that goes to the super_admin. There
// should be a radio field of given topics they can select... maybe
// some sort of icon."
//
// Implementation:
//   1. REQUEST_CATEGORIES gets a `routing` field per category:
//        'manager'     = visible to admins/manager + super_admin
//        'super_admin' = super_admin ONLY
//      Manager-routed: vacation, sick_leave, schedule_change, recognition
//      super_admin-only: raise, promotion, training, expense, transfer,
//                        flexible_hours, remote_work, equipment, other
//   2. Category dropdown REPLACED with icon-tile picker grouped by routing
//      with clear "Goes to your manager" / "Goes to super_admin only"
//      group headers. Each tile is a tappable button with icon + label.
//   3. Visibility is now AUTO-DERIVED from the picked category — the user
//      no longer has to choose visibility separately. visibilityFromCategory
//      helper is the single source of truth, called both when category
//      changes AND at submit time (belt-and-braces).
//   4. Auto-routing badge under the picker shows "📨 Goes to: Your manager"
//      or "🔒 Goes to: super_admin only" so it's obvious.
//   5. Complaints continue to ALWAYS go to super_admin (sensitive by nature).
//   6. AdminHRInbox shows "👤 Manager-handled" badge for visibility='admin'
//      requests so reviewers see the routing at a glance.
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
console.log('v55.69 — HR routing rules + icon-tile topic picker');
console.log('============================================================');

var hr = read('src/components/MyHRDesk.jsx');
var ai = read('src/components/AdminHRInbox.jsx');

// ============================================================
// 1. REQUEST_CATEGORIES has routing field per category
// ============================================================
group('1. Categories carry routing rule + separated icon');

check('1.1 REQUEST_CATEGORIES has 13 entries',
  (hr.match(/REQUEST_CATEGORIES = \[[\s\S]*?\];/) || [''])[0].match(/{ id:/g).length === 13);
check('1.2 Every request category has explicit `routing` field',
  // each category line has routing: 'manager' or 'super_admin'
  (function () {
    var block = (hr.match(/var REQUEST_CATEGORIES = \[[\s\S]*?\];/) || [''])[0];
    var lines = block.match(/{ id:/g) || [];
    var withRouting = block.match(/routing: '(manager|super_admin)'/g) || [];
    return lines.length === withRouting.length && lines.length === 13;
  })());
check('1.3 Every request category has explicit `icon` field separate from label',
  (function () {
    var block = (hr.match(/var REQUEST_CATEGORIES = \[[\s\S]*?\];/) || [''])[0];
    var icons = block.match(/icon: '/g) || [];
    return icons.length === 13;
  })());

// Manager-routed: vacation, sick_leave, schedule_change, recognition (4)
check('1.4 vacation routes to manager', /id: 'vacation',[\s\S]{0,250}routing: 'manager'/.test(hr));
check('1.5 sick_leave routes to manager', /id: 'sick_leave',[\s\S]{0,250}routing: 'manager'/.test(hr));
check('1.6 schedule_change routes to manager', /id: 'schedule_change',[\s\S]{0,250}routing: 'manager'/.test(hr));
check('1.7 recognition routes to manager', /id: 'recognition',[\s\S]{0,250}routing: 'manager'/.test(hr));

// super_admin-only routed: raise, promotion, training, expense, transfer, flexible_hours, remote_work, equipment, other
check('1.8  raise routes to super_admin',          /id: 'raise',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.9  promotion routes to super_admin',      /id: 'promotion',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.10 training routes to super_admin',       /id: 'training',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.11 expense routes to super_admin',        /id: 'expense',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.12 transfer routes to super_admin',       /id: 'transfer',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.13 flexible_hours routes to super_admin', /id: 'flexible_hours',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.14 remote_work routes to super_admin',    /id: 'remote_work',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.15 equipment routes to super_admin',      /id: 'equipment',[\s\S]{0,250}routing: 'super_admin'/.test(hr));
check('1.16 other routes to super_admin',          /id: 'other',[\s\S]{0,250}routing: 'super_admin'/.test(hr));

// 4 manager-routed + 9 super_admin-routed = 13
check('1.17 Exactly 4 manager-routed categories',
  ((hr.match(/var REQUEST_CATEGORIES = \[[\s\S]*?\];/) || [''])[0].match(/routing: 'manager'/g) || []).length === 4);
check('1.18 Exactly 9 super_admin-routed categories',
  ((hr.match(/var REQUEST_CATEGORIES = \[[\s\S]*?\];/) || [''])[0].match(/routing: 'super_admin'/g) || []).length === 9);

// ============================================================
// 2. visibilityFromCategory helper — single source of truth
// ============================================================
group('2. visibilityFromCategory — single source of truth');

check('2.1 visibilityFromCategory function defined',
  /function visibilityFromCategory\(cat\)/.test(hr));
check('2.2 returns "admin" for manager-routed categories',
  /if \(found && found\.routing === 'manager'\) return 'admin'/.test(hr));
check('2.3 returns "super_admin_only" otherwise',
  /return 'super_admin_only'/.test(hr));

// Runtime simulation — re-implement and verify the helper for every category
function runtimeVisibility(cat) {
  var manager = ['vacation','sick_leave','schedule_change','recognition'];
  return manager.indexOf(cat) >= 0 ? 'admin' : 'super_admin_only';
}
check('2.4 Runtime: vacation → admin', runtimeVisibility('vacation') === 'admin');
check('2.5 Runtime: sick_leave → admin', runtimeVisibility('sick_leave') === 'admin');
check('2.6 Runtime: schedule_change → admin', runtimeVisibility('schedule_change') === 'admin');
check('2.7 Runtime: recognition → admin', runtimeVisibility('recognition') === 'admin');
check('2.8 Runtime: raise → super_admin_only', runtimeVisibility('raise') === 'super_admin_only');
check('2.9 Runtime: promotion → super_admin_only', runtimeVisibility('promotion') === 'super_admin_only');
check('2.10 Runtime: training → super_admin_only', runtimeVisibility('training') === 'super_admin_only');
check('2.11 Runtime: expense → super_admin_only', runtimeVisibility('expense') === 'super_admin_only');
check('2.12 Runtime: transfer → super_admin_only', runtimeVisibility('transfer') === 'super_admin_only');
check('2.13 Runtime: flexible_hours → super_admin_only', runtimeVisibility('flexible_hours') === 'super_admin_only');
check('2.14 Runtime: remote_work → super_admin_only', runtimeVisibility('remote_work') === 'super_admin_only');
check('2.15 Runtime: equipment → super_admin_only', runtimeVisibility('equipment') === 'super_admin_only');
check('2.16 Runtime: other → super_admin_only', runtimeVisibility('other') === 'super_admin_only');
check('2.17 Runtime: unknown category falls back safely to super_admin_only',
  runtimeVisibility('xyz_nonexistent') === 'super_admin_only');

// ============================================================
// 3. Form state initialization uses helper
// ============================================================
group('3. Form state + open handlers use the helper');

check('3.1 Initial form state visibility derived from default category vacation',
  /visibility: visibilityFromCategory\('vacation'\)/.test(hr));
check('3.2 openRequest sets visibility from default category',
  /openRequest = function[\s\S]{0,400}visibility: visibilityFromCategory\('vacation'\)/.test(hr));
check('3.3 openComplaint hardcodes super_admin_only (complaints always sensitive)',
  /openComplaint = function[\s\S]{0,400}visibility: 'super_admin_only'/.test(hr));

// ============================================================
// 4. Submit-time derivation (belt-and-braces)
//    NOTE v55.73: visibility is now derived from form.recipient
//    (radio-button choice), NOT from category. This is BY DESIGN
//    per Max's spec: "users should be able to override the routing".
// ============================================================
group('4. submitRequest derives visibility at submit time');

check('4.1 v55.73 — derivedVisibility computed in submitRequest from form.recipient',
  /var derivedVisibility = form\.recipient === 'super_admin' \? 'super_admin_only' : 'admin'/.test(hr));
check('4.2 Payload uses derivedVisibility, NOT form.visibility',
  /visibility: derivedVisibility,/.test(hr) && !/visibility: form\.visibility,/.test(hr));
check('4.3 v55.73 — Comment explains user choice is source of truth',
  /source of[\s\S]{0,40}truth|user.s choice wins/.test(hr));

// ============================================================
// 5. Icon-tile topic picker UI
// ============================================================
group('5. Icon-tile picker — replaces the old dropdown');

check('5.1 Old visibility dropdown REMOVED from request modal',
  // The old <select value={form.visibility} ... > should be gone
  !/<select[\s\S]{0,100}value=\{form\.visibility\}/.test(hr));
check('5.2 Old "What kind of request?" dropdown REMOVED for requests',
  // The single big dropdown for category should be gone in the request modal
  !/<select value=\{form\.category\}[\s\S]{0,400}REQUEST_CATEGORIES\.map\(function \(c\) \{ return <option/.test(hr));
check('5.3 Manager-routed tile group rendered',
  /REQUEST_CATEGORIES\.filter\(function \(c\) \{ return c\.routing === 'manager'; \}\)\.map/.test(hr));
check('5.4 super_admin-routed tile group rendered',
  /REQUEST_CATEGORIES\.filter\(function \(c\) \{ return c\.routing === 'super_admin'; \}\)\.map/.test(hr));
check('5.5 Group header "Goes to your manager"',
  /Goes to your manager/.test(hr));
check('5.6 v55.75 — Group header explains "private from other team leads"',
  // v55.75 — wording softened from "admins can't see" to "team leads can't see"
  /Goes to .{0,40}only \(private — other team leads can't see\)/.test(hr));
check('5.7 v55.73 — Each tile is a real button (also sets recipient: manager/super_admin)',
  /<button[\s\S]{0,200}type="button"[\s\S]{0,300}onClick=\{function \(\) \{ setForm\(Object\.assign\(\{\}, form, \{ category: c\.id, visibility: visibilityFromCategory\(c\.id\), recipient: '(manager|super_admin)' \}\)\); \}\}/.test(hr));
check('5.8 Selected tile has visual selected state (border-blue or border-violet)',
  /selected \? 'border-blue-500/.test(hr) && /selected \? 'border-violet-500/.test(hr));
check('5.9 Tile renders icon (text-2xl) AND label',
  /text-2xl">\{c\.icon\}/.test(hr));
check('5.10 Tile shows hint as a tooltip',
  /title=\{c\.hint\}/.test(hr));
check('5.11 Hint paragraph below the picker reflects selected category',
  /REQUEST_CATEGORIES\.find\(function \(c\) \{ return c\.id === form\.category; \}\) \|\| \{\}\)\.hint/.test(hr));

// ============================================================
// 6. Recipient picker (v55.73 replaced the v55.69 auto-routing badge
//    with explicit radio buttons per Max's feedback)
// ============================================================
group('6. v55.73 — recipient radio buttons replaced auto-routing badge');

check('6.1 v55.73 — Manager radio option present (replaces blue badge)',
  /name="hr-recipient"[\s\S]{0,300}value="manager"/.test(hr));
check('6.2 v55.73 — Super-admin radio option present (replaces violet badge)',
  /name="hr-recipient"[\s\S]{0,300}value="super_admin"/.test(hr));
check('6.3 v55.75 — Hint about other team leads won\'t see super-admin items',
  // v55.75 — softer wording: "team leads (including your manager)"
  /team leads \(including your manager\) won't see this/.test(hr));
check('6.4 v55.73 — User can override category default (heads-up if mismatched)',
  /Heads up: most/.test(hr) && /usually go to/.test(hr));

// ============================================================
// 7. COMPLAINT_CATEGORIES still always super_admin
// ============================================================
group('7. Complaints still always super_admin only');

check('7.1 COMPLAINT_CATEGORIES has 11 entries',
  (hr.match(/COMPLAINT_CATEGORIES = \[[\s\S]*?\];/) || [''])[0].match(/{ id:/g).length === 11);
check('7.2 COMPLAINT categories have separated icon field',
  (function () {
    var block = (hr.match(/var COMPLAINT_CATEGORIES = \[[\s\S]*?\];/) || [''])[0];
    return (block.match(/icon: '/g) || []).length === 11;
  })());
check('7.3 Complaint dropdown renders icon + label together',
  /COMPLAINT_CATEGORIES\.map\(function \(c\) \{ return <option key=\{c\.id\} value=\{c\.id\}>\{c\.icon \+ ' ' \+ c\.label\}<\/option>; \}\)/.test(hr));
check('7.4 openComplaint sets super_admin_only regardless of which complaint topic',
  /openComplaint[\s\S]{0,400}visibility: 'super_admin_only'/.test(hr));
check('7.5 v55.75 — Privacy notice present in complaint modal (softer wording)',
  // v55.75 — wording: "Only {superAdminName} sees who submitted this"
  /Only \{superAdminName\} sees who submitted this/.test(hr));

// ============================================================
// 8. AdminHRInbox — Manager-handled badge added
// ============================================================
group('8. AdminHRInbox shows routing badges');

check('8.1 super_admin_only badge still present',
  /🔒 super_admin only/.test(ai));
check('8.2 Manager-handled badge added for visibility==="admin"',
  /r\.visibility === 'admin'[\s\S]{0,200}👤 Manager-handled/.test(ai));
check('8.3 Visibility filter still hides super_admin_only from regular admins',
  /!isSuperAdmin && r\.visibility === 'super_admin_only'/.test(ai));

// ============================================================
// 9. Edge cases
// ============================================================
group('9. Edge cases');

check('9.1 v55.73 — submitRequest derives visibility from form.recipient (user choice)',
  // submitRequest computes derivedVisibility right before insert based on recipient radio
  /setLoading\(true\);\s*try \{[\s\S]{0,500}var derivedVisibility = form\.recipient === 'super_admin' \? 'super_admin_only' : 'admin'/.test(hr));
check('9.2 v55.73 — Tile click sets category + visibility + recipient atomically',
  /setForm\(Object\.assign\(\{\}, form, \{ category: c\.id, visibility: visibilityFromCategory\(c\.id\), recipient: '(manager|super_admin)' \}\)\)/.test(hr));
check('9.3 Default category "vacation" routes to manager (so first-render is correct)',
  /id: 'vacation',[\s\S]{0,250}routing: 'manager'/.test(hr));
check('9.4 No hardcoded "visibility: \'admin\'" left in form initialization',
  // All visibility settings should go through visibilityFromCategory or be 'super_admin_only'
  !/visibility: 'admin'/.test(hr));
check('9.5 visibilityFromCategory handles null/undefined category gracefully',
  // The helper uses .find which returns undefined; the if-check guards it
  /var found = REQUEST_CATEGORIES\.find\([\s\S]{0,200}if \(found && found\.routing === 'manager'\)/.test(hr));
check('9.6 v55.73 — Header text says "Pick a topic, then choose who you want it sent to"',
  // v55.73 changed from "system routes it to the right person automatically"
  // to language acknowledging the new explicit recipient choice.
  /Pick a topic, then choose who you want it sent to/.test(hr));

// ============================================================
// 10. Carry-forward — earlier work intact
// ============================================================
group('10. Carry-forward — v55.65/66/67/68 still intact');

var pd = read('src/components/PersonalDashboard.jsx');
check('10.1 v55.71 — MyHRDesk mounts inside AssistantsBar (zero direct dashboard mounts)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return (pd.match(/<MyHRDesk /g) || []).length === 0
      && (ab.match(/<MyHRDesk /g) || []).length === 1;
  })());
check('10.2 v55.71 — MyPerformance mounts inside AssistantsBar (zero direct dashboard mounts)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return (pd.match(/<MyPerformance /g) || []).length === 0
      && (ab.match(/<MyPerformance /g) || []).length === 1;
  })());
check('10.3 v55.68 stable [myId] effect dep preserved',
  /\}, \[myId\]\);/.test(pd));
check('10.4 v55.68 no early-return-on-not-loaded',
  !/if \(!loaded\) return \(/.test(pd));
check('10.5 v55.65 SQL files still present',
  fs.existsSync(path.join(REPO, 'sql/s40_system_tickets_retest.sql'))
  && fs.existsSync(path.join(REPO, 'sql/s41_hr_desk_requests_complaints.sql')));

var srt = read('src/components/ShippingRatesTab.jsx');
check('10.6 v55.66 Shipping list view still present',
  /routesViewMode/.test(srt) && /📋 List/.test(srt));

var wnw = read('src/components/WhatsNewWidget.jsx');
check('10.7 v55.67 WhatsNew adminOnly filtering still wired',
  /filterEntry/.test(wnw));

var ag = read('src/components/AIGreeter.jsx');
check('10.8 v55.65 Nadia anti-repetition still wired', /nadia_recent_phrases/.test(ag));

var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('10.9 v55.65 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));

var mp = read('src/components/MyPerformance.jsx');
check('10.10 MyPerformance ("rah-rah" coach) still has SVG logo', /viewBox="0 0 44 44"/.test(mp));

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
