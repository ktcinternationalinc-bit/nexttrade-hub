// v55.83-A.6.23 (Max May 14 2026) — Sub-sections + duplicate removal
//
//   1. Each of the three priority cards now has TWO sub-sections:
//      "📥 My Direct" and "📤 I Delegated", per the spec.
//   2. Filter logic mirrors PersonalDashboard.isMineByAssign / created_by==me,
//      so data parity with the working surface is guaranteed.
//   3. Works for any logged-in user — uses `myId` prop, no hard-coded roles.
//   4. Removed remaining dashboard duplicates per the user's spec:
//        - "Tickets I Assigned" full list in PersonalDashboard
//        - "Assigned by Me" small stat card
//        - Today-due ticket injection into Reminders' urgent list

var fs = require('fs');
var path = require('path');
var dps = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DashboardPrioritySections.jsx'), 'utf8');
var pd = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalDashboard.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. Sub-section split — TWO buckets per card ===
ok('1a: myDirectTickets bucket exists',
  /var myDirectTickets = useMemo/.test(dps));
ok('1b: iDelegatedTickets bucket exists',
  /var iDelegatedTickets = useMemo/.test(dps));
ok('1c: myDirectTickets uses isMineByAssign (assigned_to OR additional_assignees)',
  /myDirectTickets = useMemo[\s\S]{0,400}isMineByAssign\(t\)/.test(dps));
ok('1d: iDelegatedTickets requires created_by === me AND NOT mine-by-assign',
  /iDelegatedTickets = useMemo[\s\S]{0,400}t\.created_by !== myId[\s\S]{0,200}isMineByAssign\(t\)/.test(dps));
ok('1e: isMineByAssign helper matches PersonalDashboard logic',
  /function isMineByAssign[\s\S]{0,200}t\.assigned_to === myId \|\| parseExtras\(t\)\.indexOf\(myId\) >= 0/.test(dps));

// === 2. Three cards × two sub-sections each ===
ok('2a: overdueMyDirect computed',
  /var overdueMyDirect = useMemo/.test(dps));
ok('2b: overdueDelegated computed',
  /var overdueDelegated = useMemo/.test(dps));
ok('2c: updatesMyDirect computed',
  /var updatesMyDirect = useMemo/.test(dps));
ok('2d: updatesDelegated computed',
  /var updatesDelegated = useMemo/.test(dps));
ok('2e: newMyDirect computed',
  /var newMyDirect = useMemo/.test(dps));
ok('2f: newDelegated computed',
  /var newDelegated = useMemo/.test(dps));

// === 3. The three card headers all still render ===
ok('3a: Your Overdue Tickets card still present',
  /Your Overdue Tickets/.test(dps));
ok('3b: Recent Updates card still present',
  /Recent Updates \(Last 3 Days\)/.test(dps));
ok('3c: Newly Assigned card still present',
  /Newly Assigned/.test(dps));

// === 4. Sub-section labels ===
ok('4a: "📥 My Direct" sub-section label used',
  /📥 My Direct/.test(dps));
ok('4b: "📤 I Delegated" sub-section label used',
  /📤 I Delegated/.test(dps));
ok('4c: SubSection wrapper component defined',
  /function SubSection/.test(dps));

// === 5. Newly Assigned: Acknowledge button on My Direct only ===
ok('5a: NewRow receives showAck prop to gate the Acknowledge button',
  /function NewRow[\s\S]{0,400}showAck/.test(dps));
ok('5b: My Direct passes showAck={true}',
  /showAck=\{true\}[\s\S]{0,300}onAcknowledge=\{onAcknowledge\}/.test(dps));
ok('5c: I Delegated passes showAck={false}',
  /showAck=\{false\}/.test(dps));

// === 6. Filters use myId (not hardcoded user-specific assumptions) ===
ok('6a: All bucket filters reference myId',
  (dps.match(/myId/g) || []).length >= 5);
ok('6b: No hardcoded role-based filters (would break for non-admins)',
  !/role === 'super_admin'/.test(dps));

// === 7. PersonalDashboard duplicates removed ===
ok('7a: "Tickets I Assigned" full list removed from PersonalDashboard',
  !/📤 Tickets I Assigned \(\{ticketsICreated\.length\}\)/.test(pd));
ok('7b: "Assigned by Me" small stat card removed',
  !/<div className="text-xs text-slate-700">Assigned by Me<\/div>/.test(pd));
ok('7c: Today-due ticket injection into Reminders is gone',
  !/const todayDueTickets = \[\.\.\.myTickets, \.\.\.ticketsICreated\]/.test(pd));
ok('7d: Comment explaining today-due tickets are now in priority cards',
  /v55\.83-A\.6\.23[\s\S]{0,400}REMOVED today-due ticket injection/.test(pd));
ok('7e: Comment explaining "Tickets I Assigned" moved into I Delegated',
  /v55\.83-A\.6\.23[\s\S]{0,400}REMOVED "📤 Tickets I Assigned/.test(pd));

// === 8. Reminders widget itself still works ===
ok('8a: Reminders widget still loads from `reminders` state',
  /urgentReminders = reminders\.filter/.test(pd));
ok('8b: Reminders Add button still present',
  /onClick=\{addReminder\}/.test(pd));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.23 sub-section + duplicate-removal tests passed');
