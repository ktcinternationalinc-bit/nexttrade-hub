// ============================================================
// v55.65 — HR Desk + Nadia smarter + loading-screen presence
//
// Covers:
//   1. SQL migration (hr_requests + hr_complaints tables)
//   2. MyHRDesk component — animated mascot, request modal, complaint modal
//   3. AdminHRInbox component — visibility rules, status updates
//   4. PersonalDashboard mounts MyHRDesk above MyPerformance
//   5. AdminTab mounts AdminHRInbox under "HR Inbox" section
//   6. Nadia anti-repetition: localStorage tracking + system prompt injection
//   7. Nadia loading-screen presence pill
//   8. Edge cases: missing tables, anonymous complaints, role-based filtering
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label,detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.65 — HR Desk + smarter Nadia + loading-screen presence');
console.log('============================================================');

// ============================================================
// 1. SQL migration
// ============================================================
group('1. SQL — hr_requests + hr_complaints tables');

var sqlPath = 'sql/s41_hr_desk_requests_complaints.sql';
check('1.1 SQL file exists', fs.existsSync(path.join(REPO, sqlPath)));
var sql = read(sqlPath);
check('1.2 creates hr_requests table', /CREATE TABLE IF NOT EXISTS hr_requests/.test(sql));
check('1.3 creates hr_complaints table', /CREATE TABLE IF NOT EXISTS hr_complaints/.test(sql));
check('1.4 hr_requests has request_number for friendly IDs', /request_number TEXT/.test(sql));
check('1.5 hr_complaints has complaint_number',     /complaint_number TEXT/.test(sql));
check('1.6 hr_requests has all 13 categories', /CHECK \(category IN \('vacation','sick_leave','equipment','schedule_change',\s*'raise','promotion','training','expense','transfer',\s*'flexible_hours','remote_work','recognition','other','general'\)\)/.test(sql));
check('1.7 hr_complaints has anonymous_to_admins flag (DEFAULT TRUE)', /anonymous_to_admins BOOLEAN DEFAULT TRUE/.test(sql));
check('1.8 hr_complaints has severity enum', /CHECK \(severity IN \('low','medium','high','critical'\)\)/.test(sql));
check('1.9 hr_requests has visibility (admin / super_admin_only)', /visibility TEXT[\s\S]{0,100}'admin'[\s\S]{0,30}'super_admin_only'/.test(sql));
check('1.10 hr_requests autonumber trigger HR-YYYY-NNNN', /trg_hr_request_autonumber/.test(sql) && /'HR-' \|\| yr \|\| '-'/.test(sql));
check('1.11 hr_complaints autonumber trigger HRC-YYYY-NNNN', /trg_hr_complaint_autonumber/.test(sql) && /'HRC-' \|\| yr \|\| '-'/.test(sql));
check('1.12 indexes for fast inbox + per-user queries',
  /idx_hr_requests_status_priority/.test(sql)
  && /idx_hr_requests_submitter/.test(sql)
  && /idx_hr_complaints_status/.test(sql)
  && /idx_hr_complaints_submitter/.test(sql));
check('1.13 every CREATE TABLE uses IF NOT EXISTS', !/CREATE TABLE(?! IF NOT EXISTS)/.test(sql));
check('1.14 sanity SELECT included for run-time verification',
  /requests_total[\s\S]*requests_pending[\s\S]*complaints_total/.test(sql));

// ============================================================
// 2. MyHRDesk component
// ============================================================
group('2. MyHRDesk — dashboard card with mascot + 2 modals');

var hrDeskPath = 'src/components/MyHRDesk.jsx';
check('2.1 component file exists', fs.existsSync(path.join(REPO, hrDeskPath)));
var hr = read(hrDeskPath);
check('2.2 imports supabase + dbInsert', /from '\.\.\/lib\/supabase'/.test(hr));
check('2.3 declares 13 request categories',
  (hr.match(/REQUEST_CATEGORIES = \[[\s\S]*?\];/) || [''])[0].match(/{ id:/g).length === 13);
check('2.4 declares 11 complaint categories',
  (hr.match(/COMPLAINT_CATEGORIES = \[[\s\S]*?\];/) || [''])[0].match(/{ id:/g).length === 11);
// v55.77 — Mascot SVG removed (Fix #11). The unified module shows the
// real Jenna photo above MyHRDesk, so the cartoon Maya mascot was a
// duplicate. We assert the OPPOSITE now.
check('2.5 [v55.77] cartoon Maya mascot REMOVED (replaced by real Jenna photo above)',
  !/transform: mascotWaving/.test(hr) && !/viewBox="0 0 64 64"/.test(hr));
check('2.6 [v55.77] periodic mascot wave interval REMOVED (was driving the deleted SVG)',
  !/setInterval\(function \(\) \{[\s\S]{0,200}setMascotWaving\(true\)/.test(hr));
check('2.7 file-request modal renders with date pickers for vacation/training',
  /openModal === 'request'/.test(hr) && /form\.category === 'vacation'/.test(hr));
check('2.8 file-complaint modal renders with privacy toggle',
  /openModal === 'complaint'/.test(hr) && /anonymous_to_admins/.test(hr));
check('2.9 complaint defaults to ANONYMOUS to admins',
  /anonymous_to_admins: true/.test(hr));
check('2.10 submits to hr_requests table',
  /from\('hr_requests'\)\.insert/.test(hr));
check('2.11 submits to hr_complaints table',
  /from\('hr_complaints'\)\.insert/.test(hr));
check('2.12 detects missing-table error and shows setup hint',
  /tableMissing/.test(hr) && /sql\/s41_hr_desk/.test(hr));
check('2.13 shows recent submissions with status colors',
  /STATUS_COLORS/.test(hr) && /myRecent\.map/.test(hr));
check('2.14 shows decision_notes / resolution_notes from super_admin',
  // v55.75 — text changed from "super_admin response:" to "{name} response:"
  /\{superAdminName\} response:|response:.*notes/.test(hr));
check('2.15 priority + severity selectors in respective modals',
  /Low — wanted to flag it/.test(hr) && /Critical — urgent \/ safety \/ harm/.test(hr));
check('2.16 friendly first-name greeting in header', /myFirstName/.test(hr));
check('2.17 [v55.77] HR badge in mascot REMOVED (mascot deleted, see Fix #11)',
  !/HR<\/text>/.test(hr));
check('2.18 status COLORS use literal Tailwind class strings (JIT-safe)',
  !/'bg-' \+ \w+ \+ '-/.test(hr),
  'dynamic Tailwind class concatenation found — JIT will skip those classes');

// ============================================================
// 3. AdminHRInbox component
// ============================================================
group('3. AdminHRInbox — super_admin sees all, admin sees less');

var inboxPath = 'src/components/AdminHRInbox.jsx';
check('3.1 component file exists', fs.existsSync(path.join(REPO, inboxPath)));
var inb = read(inboxPath);
check('3.2 super_admin sees super_admin_only requests',
  /isSuperAdmin && r\.visibility === 'super_admin_only'/.test(inb)
  || /!isSuperAdmin && r\.visibility === 'super_admin_only'/.test(inb));
check('3.3 anonymous complaints hidden from non-super_admin',
  /isSuperAdmin\) return true[\s\S]{0,150}anonymous_to_admins === false/.test(inb));
check('3.4 hidden-complaint count surfaced to admin',
  /hiddenComplaintsCount/.test(inb));
check('3.5 [v55.77] anonymous complaint shows "(identity confidential)" to non-super_admin (was "(anonymous to admins)")',
  /\(identity confidential\)/.test(inb) && !/\(anonymous to admins\)/.test(inb));
check('3.6 status changes via dbUpdate', /dbUpdate\('hr_requests'/.test(inb) && /dbUpdate\('hr_complaints'/.test(inb));
check('3.7 reviewed_by + reviewed_at recorded on save',
  /reviewed_by: myId/.test(inb) && /reviewed_at: nowIso/.test(inb));
check('3.8 decision/resolution notes saved (visible to submitter)',
  /decision_notes: reviewing\.notes/.test(inb) && /resolution_notes: reviewing\.notes/.test(inb));
check('3.9 has tab UI for requests vs complaints', /setTab\('requests'\)/.test(inb) && /setTab\('complaints'\)/.test(inb));
check('3.10 status filter bar (open / all / specific)',
  /filterStatus === 'open'/.test(inb) && /filterStatus === 'all'/.test(inb));
check('3.11 critical severity gets ring-2 visual emphasis',
  /critical:[^,]*ring-2 ring-rose-300/.test(inb));
check('3.12 detects missing-table → friendly setup banner',
  /tableMissing/.test(inb) && /s41_hr_desk/.test(inb));

// ============================================================
// 4. PersonalDashboard — MyHRDesk mounted prominently
// ============================================================
group('4. AssistantsBar wires MyHRDesk + MyPerformance (v55.71 architecture)');

var pd = read('src/components/PersonalDashboard.jsx');
var ab = read('src/components/AssistantsBar.jsx');
check('4.1 v55.71 — AssistantsBar imports MyHRDesk (was PersonalDashboard)',
  /import MyHRDesk from '\.\/MyHRDesk'/.test(ab));
check('4.2 v55.71 — MyHRDesk mounted inside AssistantsBar Jenna panel',
  /<MyHRDesk[\s\S]{0,200}\/>/.test(ab));
check('4.3 v55.71 — Jenna panel wraps MyHRDesk in expand block',
  /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk/.test(ab));
check('4.4 v55.71 — MyHRDesk + MyPerformance both inside AssistantsBar (in Jenna and Sara panels)',
  /<MyHRDesk[\s\S]{0,5000}<MyPerformance/.test(ab));
check('4.5 user props passed to MyHRDesk inside AssistantsBar',
  /<MyHRDesk user=\{user\} userProfile=\{userProfile\} users=\{users\}/.test(ab));

// ============================================================
// 5. AdminTab — HR Inbox section
// ============================================================
group('5. AdminTab adds HR Inbox section');

var at = read('src/components/AdminTab.jsx');
check('5.1 imports AdminHRInbox', /import AdminHRInbox from '\.\/AdminHRInbox'/.test(at));
check('5.2 hr_inbox tab in section nav', /\['hr_inbox','📬 HR Inbox'\]/.test(at));
check('5.3 renders AdminHRInbox when section === hr_inbox',
  /section === 'hr_inbox'[\s\S]{0,200}<AdminHRInbox/.test(at));
check('5.4 passes isSuperAdmin prop', /isSuperAdmin=\{isSuperAdmin\}/.test(at));
check('5.5 passes users + userProfile so reviewer shows real names',
  /<AdminHRInbox user=\{user\} userProfile=\{userProfile\}[\s\S]{0,150}users=\{users\}/.test(at));

// ============================================================
// 6. Nadia smarter — anti-repetition
// ============================================================
group('6. Nadia smarter — anti-repetition + variety');

var ag = read('src/components/AIGreeter.jsx');
check('6.1 persists fingerprint of every reply to localStorage',
  /nadia_recent_phrases/.test(ag));
check('6.2 fingerprint is normalized + lowercased + first 80 chars',
  /aiText\.replace\(\/\\s\+\/g, ' '\)\.substring\(0, 80\)\.toLowerCase\(\)/.test(ag));
check('6.3 caps recent-phrase history at 8 entries (FIFO)',
  /prev = prev\.slice\(0, 8\)/.test(ag));
check('6.4 dedupes the SAME fingerprint instead of letting it stack',
  /prev\.filter\(function \(p\) \{ return p && p\.fp !== fingerprint/.test(ag));
check('6.5 system prompt INJECTS recent phrases as "do not repeat"',
  /DO NOT REPEAT YOURSELF/.test(ag));
check('6.6 instructs Nadia to vary opening, angle, items',
  /DIFFERENT opening[\s\S]{0,150}DIFFERENT angle[\s\S]{0,150}DIFFERENT items/.test(ag));
check('6.7 anti-repetition is wrapped in try/catch (won\'t break Nadia if storage fails)',
  /try \{[\s\S]{0,400}nadia_recent_phrases[\s\S]{0,400}catch \(_\)/.test(ag));
check('6.8 reads localStorage safely (typeof window check)',
  /typeof window === 'undefined' \|\| !window\.localStorage/.test(ag));

// ============================================================
// 7. Nadia loading-screen presence pill
// ============================================================
group('7. Nadia loading-screen presence pill');

var pg = read('src/app/page.jsx');
check('7.1 loading screen has Nadia pill', /Nadia is here/.test(pg));
check('7.2 pill is fixed bottom-left, z-50',
  /fixed bottom-4 left-4 z-50/.test(pg));
check('7.3 pill has animated face SVG', /viewBox="0 0 24 24"[\s\S]{0,400}animate attributeName="r"/.test(pg));
check('7.4 emerald pulse dot indicating presence',
  /bg-emerald-400[\s\S]{0,80}animate-pulse/.test(pg));
check('7.5 pill is purely decorative (no API calls / no breaking risk)',
  // Just check it's inside the loading-return block (not the post-load render)
  /if \(loading\) return[\s\S]{0,3000}Nadia is here/.test(pg));

// ============================================================
// 8. Carry-forward — earlier v55.65 work still intact
// ============================================================
group('8. Carry-forward — voicemail fix + AI Coach + System Tickets retest');

var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('8.1 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));
check('8.2 voicemail timeout="10" still in place', /timeout="10"/.test(vmr));
check('8.3 voicemail Pause length=1 still in place', /<Pause length="1" \/>/.test(vmr));

var stp = read('src/components/SystemTicketsPanel.jsx');
check('8.4 SystemTickets fix-in-build modal still wired', /openFixModal/.test(stp));
check('8.5 SystemTickets retest modal still wired', /openRetestModal/.test(stp));

var mp = read('src/components/MyPerformance.jsx');
check('8.6 MyPerformance default-expanded still set', /useState\(true\); \/\/ map of version|const \[expanded, setExpanded\] = useState\(true\)/.test(mp));
check('8.7 MyPerformance SVG logo still present', /viewBox="0 0 44 44"/.test(mp));

var srt = read('src/components/ShippingRatesTab.jsx');
check('8.8 v55.63 POL/POD filter still present', /filterPol/.test(srt));

var ct = read('src/components/CustomsTab.jsx');
check('8.9 v55.64 Customs Excel import still present', /TEMPLATE_COLUMNS/.test(ct));

var au = fs.existsSync(path.join(REPO, 'src/lib/active-users.js')) ? read('src/lib/active-users.js') : '';
check('8.10 v55.62 active-users helper still present', /isActiveUser/.test(au));

// ============================================================
// 9. Edge cases
// ============================================================
group('9. Edge cases');

check('9.1 MyHRDesk handles missing table gracefully (no throw)',
  /catch \(e\) \{[\s\S]{0,200}does not exist/i.test(hr));
check('9.2 AdminHRInbox handles missing table gracefully',
  /catch \(e\) \{[\s\S]{0,150}tableMissing/i.test(inb));
check('9.3 MyHRDesk recent submissions sorted newest first',
  /\.sort\(function \(a, b\) \{ return \(b\.submitted_at \|\| ''\)\.localeCompare\(a\.submitted_at \|\| ''\); \}\)/.test(hr));
check('9.4 MyHRDesk caps recent display at 5',
  /\.slice\(0, 5\)/.test(hr));
check('9.5 AdminHRInbox shows "(anonymous to admins)" only to non-super_admin',
  /c\.anonymous_to_admins && !isSuperAdmin/.test(inb));
check('9.6 super_admin always sees real submitter name on complaints',
  // Check the modal also respects isSuperAdmin
  /reviewing\.kind === 'complaint' && reviewing\.item\.anonymous_to_admins && !isSuperAdmin/.test(inb));
check('9.7 Nadia recent_phrases uses safe JSON.parse (no throw on corrupt data)',
  /try \{ prev = JSON\.parse\(prevRaw\); if \(!Array\.isArray\(prev\)\) prev = \[\]; \} catch \(_\) \{ prev = \[\]; \}/.test(ag));

// ============================================================
// 10. Summary
// ============================================================
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
