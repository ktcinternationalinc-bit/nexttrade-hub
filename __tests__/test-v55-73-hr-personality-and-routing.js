// ============================================================
// v55.73 — HR Desk personality + recipient radio + dispatch fix
//
// Max May 8 2026 reported four issues from screenshot:
//   1. The yellow-on-yellow "Goes to" badge is unreadable. Need much
//      higher contrast.
//   2. There should be radio buttons for who the message goes to —
//      Manager vs Mr. Kandil (super_admin) — instead of an opaque
//      auto-routing decision the user can't see or override.
//   3. The system was showing a routing badge but in the background
//      "always sending to me" regardless of the radio choice — Max
//      suspected nothing was actually being dispatched. Confirmed:
//      no /api/notify call was ever fired by submitRequest. The row
//      got inserted into hr_requests but nobody got notified.
//   4. Each agent (Nadia, Jenna, Sara) needs a personable intro —
//      "Hi, I'm Jenna, I help with HR..." — with the photo, name,
//      role, greeting. Foundation for distinct voices per character.
//
// Fixes:
//   1. New /src/lib/agent-personalities.js — single source of truth
//      for each agent's photo, name, role, tagline, greeting, tone,
//      colors, and ElevenLabs voice ID placeholder.
//   2. MyHRDesk modal headers replaced with photo + greeting card
//      (high-contrast on a tinted gradient background).
//   3. Old yellow-on-yellow auto-routing badge replaced with a
//      high-contrast radio button picker. User explicitly chooses
//      "manager" or "super_admin only". Auto-defaults from category
//      but always overridable. Includes a friendly heads-up if their
//      pick differs from the category's typical routing.
//   4. submitRequest() now actually fires /api/notify with the right
//      recipientIds list (manager from reports_to + super_admin always
//      CC'd, deduped, self excluded). submitComplaint() also fires
//      /api/notify to super_admin only.
//   5. AssistantsBar Nadia/Jenna/Sara expanded panels each now show
//      a personality intro strip with photo + name + role + greeting.
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
console.log('v55.73 — HR Desk personality + recipient radio + dispatch fix');
console.log('============================================================');

var ap = read('src/lib/agent-personalities.js');
var hr = read('src/components/MyHRDesk.jsx');
var ab = read('src/components/AssistantsBar.jsx');

// ============================================================
// 1. agent-personalities.js — single source of truth
// ============================================================
group('1. agent-personalities.js exists with three full personality records');

check('1.1 File exists with reasonable size',
  ap.length > 1500);
check('1.2 AGENT_PERSONALITIES export with three keys: nadia, jenna, sara',
  /AGENT_PERSONALITIES = \{[\s\S]*nadia:[\s\S]*jenna:[\s\S]*sara:/.test(ap));
check('1.3 Each agent has a photo path',
  /photo: '\/avatars\/nadia\.png'/.test(ap)
  && /photo: '\/avatars\/jenna\.png'/.test(ap)
  && /photo: '\/avatars\/sara\.png'/.test(ap));
check('1.4 Each agent has a personable greeting starting with "Hi" or "Hey"',
  (function () {
    // Greetings are stored in double-quoted strings (they contain apostrophes).
    var nadiaG = (ap.match(/nadia:[\s\S]*?greeting: "([^"]+)"/) || [])[1] || '';
    var jennaG = (ap.match(/jenna:[\s\S]*?greeting: "([^"]+)"/) || [])[1] || '';
    var saraG = (ap.match(/sara:[\s\S]*?greeting: "([^"]+)"/) || [])[1] || '';
    return /^Hi/.test(nadiaG) && /^Hi/.test(jennaG) && /^Hey/.test(saraG)
      && nadiaG.length > 80 && jennaG.length > 80 && saraG.length > 80;
  })());
check('1.5 Each agent has distinct tone label',
  /tone: 'executive'/.test(ap)
  && /tone: 'warm-empathetic'/.test(ap)
  && /tone: 'energetic-coach'/.test(ap));
check('1.6 Each agent has a distinct color gradient',
  /linear-gradient\(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%\)/.test(ap)
  && /linear-gradient\(135deg, #f59e0b 0%, #f43f5e 50%, #d946ef 100%\)/.test(ap)
  && /linear-gradient\(135deg, #06b6d4 0%, #0ea5e9 50%, #6366f1 100%\)/.test(ap));
check('1.7 Each agent has a voice config block (provider + voiceId placeholder)',
  // v55.73 — voice block expanded with provider/voiceId/browserFallback.
  // Field is now `voiceId` (was `elevenLabsId` in earlier draft).
  (ap.match(/voice: \{[\s\S]*?voiceId:/g) || []).length === 3
  && (ap.match(/provider: 'elevenlabs'/g) || []).length === 3
  && (ap.match(/browserFallback:/g) || []).length === 3);
check('1.8 getAgent(key) helper export with safe Nadia default',
  /export function getAgent\(key\)[\s\S]{0,200}AGENT_PERSONALITIES\[key\] \|\| AGENT_PERSONALITIES\.nadia/.test(ap));

// ============================================================
// 2. MyHRDesk modal — Jenna intro at top of both modals
// ============================================================
group('2. Jenna personality intro at top of HR modals');

check('2.1 MyHRDesk imports AGENT_PERSONALITIES',
  /import \{ AGENT_PERSONALITIES \} from '\.\.\/lib\/agent-personalities'/.test(hr));
check('2.2 Request modal header shows Jenna photo',
  /openModal === 'request'[\s\S]{0,2000}<img[\s\S]{0,200}AGENT_PERSONALITIES\.jenna\.photo/.test(hr));
check('2.3 Request modal header shows "Hi, I\'m Jenna"',
  /openModal === 'request'[\s\S]{0,3000}Hi, I'm \{AGENT_PERSONALITIES\.jenna\.name\}/.test(hr));
check('2.4 Request modal header shows Jenna greeting from personality config',
  /openModal === 'request'[\s\S]{0,3500}\{AGENT_PERSONALITIES\.jenna\.greeting\}/.test(hr));
check('2.5 Complaint modal header shows Jenna photo',
  /openModal === 'complaint'[\s\S]{0,2000}<img[\s\S]{0,200}AGENT_PERSONALITIES\.jenna\.photo/.test(hr));
check('2.6 Complaint modal header shows "Hi, I\'m Jenna"',
  /openModal === 'complaint'[\s\S]{0,3000}Hi, I'm \{AGENT_PERSONALITIES\.jenna\.name\}/.test(hr));
check('2.7 Complaint modal references super_admin name in greeting',
  /openModal === 'complaint'[\s\S]{0,3500}\{superAdminName\}/.test(hr));

// ============================================================
// 3. Recipient radio buttons replace auto-routing badge
// ============================================================
group('3. Explicit recipient radio buttons (manager / super_admin)');

check('3.1 Form state has `recipient` field initialized to "manager"',
  /recipient: 'manager'/.test(hr));
check('3.2 Manager category clicks set recipient to "manager"',
  /category: c\.id, visibility: visibilityFromCategory\(c\.id\), recipient: 'manager'/.test(hr));
check('3.3 super_admin category clicks set recipient to "super_admin"',
  /category: c\.id, visibility: visibilityFromCategory\(c\.id\), recipient: 'super_admin'/.test(hr));
check('3.4 Renders <input type="radio" name="hr-recipient">',
  /<input\s+type="radio"\s+name="hr-recipient"/.test(hr));
check('3.5 Has radio option for manager',
  /value="manager"[\s\S]{0,300}checked=\{form\.recipient === 'manager'\}/.test(hr));
check('3.6 Has radio option for super_admin',
  /value="super_admin"[\s\S]{0,300}checked=\{form\.recipient === 'super_admin'\}/.test(hr));
check('3.7 Manager radio is disabled when user has no manager assigned',
  /disabled=\{!managerId\}/.test(hr));
check('3.8 super_admin radio shows actual super_admin name (e.g. Mr. Kandil)',
  /\{superAdminName\} only \(super_admin\)/.test(hr));
check('3.9 Radio panel uses high-contrast slate-300 border + white bg (not yellow-on-yellow)',
  /rounded-lg border-2 border-slate-300 bg-white/.test(hr));
check('3.10 Selected radio gets accent border (blue for manager, violet for super_admin)',
  /form\.recipient === 'manager' \? 'border-blue-500 bg-blue-50'/.test(hr)
  && /form\.recipient === 'super_admin' \? 'border-violet-500 bg-violet-50'/.test(hr));
check('3.11 Old yellow auto-routing badge code is GONE',
  // The old "Goes to:" badge with bg-blue-50 + bg-violet-50 was a passive
  // info badge with no radio. Verify it's been replaced by the picker.
  !/<strong>📨 Goes to:<\/strong> Your manager \+ super_admin can see this/.test(hr));
check('3.12 Helpful "heads up" hint when user picks against category default',
  /Heads up: most "/.test(hr) && /usually go to/.test(hr));

// ============================================================
// 4. Recipient resolution helpers
// ============================================================
group('4. Manager + super_admin lookup from users prop');

check('4.1 Resolves myProfile from users prop using myId',
  /var myProfile = safeUsers\.find\(function \(u\) \{ return u\.id === myId; \}\)/.test(hr));
check('4.2 Reads managerId from myProfile.reports_to',
  /var managerId = \(myProfile && myProfile\.reports_to\) \|\| null/.test(hr));
check('4.3 Resolves manager record from users array',
  /var manager = managerId \? safeUsers\.find\(function \(u\) \{ return u\.id === managerId; \}\) : null/.test(hr));
check('4.4 Resolves super_admin record (role === \'super_admin\')',
  /var superAdmin = safeUsers\.find\(function \(u\) \{ return u\.role === 'super_admin' && u\.active !== false; \}\)/.test(hr));
check('4.5 superAdminName has fallback "Mr. Kandil" if no super_admin in users',
  /var superAdminName = \(superAdmin && superAdmin\.name\) \|\| 'Mr\. Kandil'/.test(hr));
check('4.6 Defensive: users prop null → safeUsers = []',
  /var safeUsers = users \|\| \[\]/.test(hr));

// ============================================================
// 5. ACTUAL notification dispatch wired up
// ============================================================
group('5. submitRequest actually dispatches /api/notify (was missing!)');

check('5.1 submitRequest has a fetch(\'/api/notify\') call',
  /var submitRequest = async function \(\)[\s\S]*?fetch\('\/api\/notify'/.test(hr));
check('5.2 Notification recipientIds array is BUILT from form.recipient choice',
  /if \(form\.recipient === 'manager' && managerId\) recipientIds\.push\(managerId\)/.test(hr));
check('5.3 super_admin is ALWAYS CC\'d on requests (so nothing falls through)',
  // After the form.recipient === 'manager' check, the next line always pushes superAdminId
  /if \(superAdminId\) recipientIds\.push\(superAdminId\)/.test(hr));
check('5.4 Recipients are de-duplicated',
  /arr\.indexOf\(rid\) === i/.test(hr));
check('5.5 Submitter is excluded from recipients (no self-notify)',
  /rid !== myId/.test(hr));
check('5.6 Notification body includes reference number + topic + priority',
  /Reference: ' \+ requestNumber/.test(hr)
  && /Topic: ' \+ catLabel/.test(hr)
  && /Priority: ' \+ form\.priority/.test(hr));
check('5.7 Notification body includes optional dates when set',
  /form\.starts_on \? 'Dates: '/.test(hr));
check('5.8 Notification body includes description when set',
  /form\.description \? '\\nDetails:\\n'/.test(hr));
check('5.9 Notification dispatch is fire-and-forget (no await blocking the submit)',
  // The pattern: fetch(...).catch(...) — no await in front
  /fetch\('\/api\/notify'[\s\S]{0,500}\}\)\.catch\(function \(e\)/.test(hr)
  && !/await fetch\('\/api\/notify'/.test(hr));
check('5.10 Notification errors are caught silently (don\'t block the user)',
  /\.catch\(function \(e\) \{ console\.warn\('\[hr_request notify\]/.test(hr));
check('5.11 type field set to \'hr_request\' in notify payload',
  /type: 'hr_request'/.test(hr));
check('5.12 Visibility is now derived from RECIPIENT (not category) — user\'s choice wins',
  /var derivedVisibility = form\.recipient === 'super_admin' \? 'super_admin_only' : 'admin'/.test(hr));

// ============================================================
// 6. submitComplaint also dispatches notification (super_admin only)
// ============================================================
group('6. submitComplaint dispatches to super_admin');

check('6.1 submitComplaint has a fetch(\'/api/notify\') call',
  /var submitComplaint = async function \(\)[\s\S]*?fetch\('\/api\/notify'/.test(hr));
check('6.2 Complaint recipient is ALWAYS super_admin only (no manager)',
  /recipientIds: \[superAdminId\]/.test(hr));
check('6.3 Complaint dispatch type is \'hr_complaint\'',
  /type: 'hr_complaint'/.test(hr));
check('6.4 Complaint subject includes severity',
  /'🚨 HR Concern \(' \+ form\.severity/.test(hr));
check('6.5 Anonymous-to-admins flag is respected in the email signature',
  /form\.anonymous_to_admins[\s\S]{0,200}'A teammate \(anonymous to admins/.test(hr));
check('6.6 Complaint dispatch is fire-and-forget',
  /\.catch\(function \(e\) \{ console\.warn\('\[hr_complaint notify\]/.test(hr));
check('6.7 No self-dispatch for complaints (super_admin filing for themselves wouldn\'t notify)',
  /superAdminId && superAdminId !== myId/.test(hr));

// ============================================================
// 7. AssistantsBar — personality intro on each panel
// ============================================================
group('7. AssistantsBar panels show photo + greeting per agent');

check('7.1 AssistantsBar imports AGENT_PERSONALITIES',
  /import \{ AGENT_PERSONALITIES \} from '\.\.\/lib\/agent-personalities'/.test(ab));
check('7.2 Nadia panel renders her photo at top',
  /openPanel === 'nadia'[\s\S]{0,1000}AGENT_PERSONALITIES\.nadia\.photo/.test(ab));
check('7.3 Nadia panel shows "Hi, I\'m Nadia" with role badge',
  /openPanel === 'nadia'[\s\S]{0,1500}Hi, I'm \{AGENT_PERSONALITIES\.nadia\.name\}/.test(ab));
check('7.4 Nadia panel includes her full greeting from config',
  /openPanel === 'nadia'[\s\S]{0,2000}\{AGENT_PERSONALITIES\.nadia\.greeting\}/.test(ab));
check('7.5 Jenna panel renders her photo at top',
  /openPanel === 'jenna'[\s\S]{0,1000}AGENT_PERSONALITIES\.jenna\.photo/.test(ab));
check('7.6 Jenna panel shows "Hi, I\'m Jenna" with role badge',
  /openPanel === 'jenna'[\s\S]{0,1500}Hi, I'm \{AGENT_PERSONALITIES\.jenna\.name\}/.test(ab));
check('7.7 Jenna panel includes her full greeting from config',
  /openPanel === 'jenna'[\s\S]{0,2000}\{AGENT_PERSONALITIES\.jenna\.greeting\}/.test(ab));
check('7.8 Sara panel renders her photo at top',
  /openPanel === 'sara'[\s\S]{0,1000}AGENT_PERSONALITIES\.sara\.photo/.test(ab));
check('7.9 Sara panel shows "Hey, I\'m Sara" (energetic-coach tone, "Hey" not "Hi")',
  /openPanel === 'sara'[\s\S]{0,1500}Hey, I'm \{AGENT_PERSONALITIES\.sara\.name\}/.test(ab));
check('7.10 Sara panel includes her full greeting from config',
  /openPanel === 'sara'[\s\S]{0,2000}\{AGENT_PERSONALITIES\.sara\.greeting\}/.test(ab));
check('7.11 v55.73 — Close buttons REMOVED (one assistant always active per Max\'s spec)',
  // Per Max May 8: "Only one assistant can be active at a time."
  // Closing makes no sense — one is always in control.
  (ab.match(/✕ Close/g) || []).length === 0);
check('7.12 Photos render as 12x12 circle (rounded-full ring-2 ring-white)',
  (ab.match(/className="w-12 h-12 rounded-full ring-2 ring-white shadow flex-shrink-0"/g) || []).length === 3);

// ============================================================
// 8. Three avatars are still the FIRST thing on the dashboard,
//    and Nadia is still the auto-open default
// ============================================================
group('8. Dashboard ordering: AssistantsBar first, Nadia auto-opens');

var pd = read('src/components/PersonalDashboard.jsx');
check('8.1 AssistantsBar is mounted at the top of PersonalDashboard',
  pd.indexOf('<AssistantsBar') < pd.indexOf('OVERDUE'));
check('8.2 v55.73 — Nadia is the HARD DEFAULT (one always active, no null state)',
  /var \[openPanel, setOpenPanel\] = useState\('nadia'\)/.test(ab));
check('8.3 v55.73 — togglePanel switches active assistant (no-op on already-active)',
  /var togglePanel = function \(which\)[\s\S]{0,500}if \(prev === which\) return prev/.test(ab));
check('8.4 v55.73 — Persona-change event dispatched so AIGreeter can swap header',
  /window\.dispatchEvent\(new CustomEvent\('ktc:assistant-changed'/.test(ab));

// ============================================================
// 9. Edge cases
// ============================================================
group('9. Edge cases');

check('9.1 If user has NO manager assigned, submitRequest still works (just CCs super_admin)',
  // The recipientIds builder skips manager push when managerId is null
  /if \(form\.recipient === 'manager' && managerId\) recipientIds\.push\(managerId\)/.test(hr));
check('9.2 If NO super_admin exists in users, submitRequest doesn\'t crash',
  // superAdminId is null in that case; the push is guarded
  /if \(superAdminId\) recipientIds\.push\(superAdminId\)/.test(hr));
check('9.3 If recipientIds is empty after dedupe, no notify call is made (skip silently)',
  /if \(recipientIds\.length > 0\)/.test(hr));
check('9.4 Manager radio is visually disabled (not just behaviorally) when no manager',
  /You don\\?'t have a manager assigned\. Ask super_admin to set your "reports_to"/.test(hr));
check('9.5 Default form.recipient = "manager" is overridden by category click handlers',
  // First click on a super_admin-routed icon (e.g. raise) flips recipient
  // to 'super_admin' so the form starts in a coherent state.
  /category: c\.id, visibility: visibilityFromCategory\(c\.id\), recipient: 'super_admin'/.test(hr));

// ============================================================
// 10. Carry-forward — earlier work intact
// ============================================================
group('10. Carry-forward — v55.65/66/67/68/69/70/71/72 still intact');

check('10.1 v55.71 — three avatar tiles still rendered',
  /who="nadia"/.test(ab) && /who="jenna"/.test(ab) && /who="sara"/.test(ab));
check('10.2 v55.71 — three real photos still in public/avatars/',
  fs.existsSync(path.join(REPO, 'public/avatars/nadia.png'))
  && fs.existsSync(path.join(REPO, 'public/avatars/jenna.png'))
  && fs.existsSync(path.join(REPO, 'public/avatars/sara.png')));
check('10.3 v55.71 — PhotoAvatar wrapper still in AssistantsBar',
  /function PhotoAvatar\(props\)/.test(ab));
check('10.4 v55.72 — formatBodyAsHtml still in /api/notify',
  /function formatBodyAsHtml\(raw\)/.test(read('src/app/api/notify/route.js')));
check('10.5 v55.72 — team-reminder send flow still passes fullBody',
  /body: fullBody/.test(read('src/app/page.jsx')));
check('10.6 v55.69 — ticket optimistic save still wired',
  /savingRef/.test(read('src/components/TicketsTab.jsx')));
check('10.7 v55.65 — voicemail trim="do-not-trim" still in place',
  /trim="do-not-trim"/.test(read('src/app/api/phone/voicemail-record/route.js')));
check('10.8 v55.65 — MyHRDesk component still present',
  hr.length > 5000);
check('10.9 v55.65 — AdminHRInbox still present',
  read('src/components/AdminHRInbox.jsx').length > 3000);

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
