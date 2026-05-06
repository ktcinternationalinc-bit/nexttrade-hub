// ============================================================
// v55.61 — Online status fix regression test
//
// Bug fixed: admin page showed user as Offline even when actively
// logged in. Three contributing causes:
//   1) Heartbeat fired only every 5 min with NO initial pulse
//   2) 5 min interval + 10 min online window = single network blip
//      = Offline appearance for ~5 min before next heartbeat
//   3) login_events table missing in Supabase (silent failure mode)
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
console.log('v55.61 — Online status fix');
console.log('============================================================\n');

// ---------- A: Heartbeat fires immediately on login + every 2 min ----------
console.log('A. Heartbeat improvements');
var pageSrc = read('src/app/page.jsx');
check('A.1 heartbeatTick function defined separately from setInterval',
  /var heartbeatTick = async function/.test(pageSrc));
check('A.2 initial heartbeat call BEFORE setInterval',
  /\/\/ Fire FIRST heartbeat right away[\s\S]{0,200}heartbeatTick\(\);[\s\S]{0,200}setInterval\(heartbeatTick/.test(pageSrc));
check('A.3 heartbeat interval is 2 minutes (was 5)',
  /setInterval\(heartbeatTick, 2 \* 60 \* 1000\)/.test(pageSrc));
check('A.4 heartbeatTick still POSTs to /api/login-event',
  /\/api\/login-event[\s\S]{0,200}event_type: 'heartbeat'/.test(pageSrc));
check('A.5 heartbeatTick wrapped in try/catch so errors never crash page',
  /var heartbeatTick = async function[\s\S]{0,2000}try \{[\s\S]{0,1000}\} catch \(e\) \{ \/\* never let a heartbeat error crash the page \*\/ \}/.test(pageSrc));

// ---------- B: AdminTab warning state ----------
console.log('\nB. AdminTab surfaces login_events table-missing warning');
var adminSrc = read('src/components/AdminTab.jsx');
check('B.1 loginSummaryWarning state declared',
  /var \[loginSummaryWarning, setLoginSummaryWarning\] = useState\(null\)/.test(adminSrc));
check('B.2 loadData captures warning from /api/login-event response',
  /if \(d && d\.warning\) setLoginSummaryWarning\(d\.warning\);[\s\S]{0,80}else setLoginSummaryWarning\(null\)/.test(adminSrc));
check('B.3 polling refresh ALSO captures warning',
  (adminSrc.match(/setLoginSummaryWarning\(d\.warning\)/g) || []).length >= 2);

// ---------- C: AdminTab renders the warning banner ----------
console.log('\nC. Warning banner renders above team table');
check('C.1 banner only shows when loginSummaryWarning is truthy',
  /\{loginSummaryWarning && \(/.test(adminSrc));
check('C.2 banner mentions login-events.sql by name',
  /supabase\/login-events\.sql/.test(adminSrc));
check('C.3 banner says "Online status not working"',
  /Online status not working/.test(adminSrc));
check('C.4 banner has amber styling for visibility',
  /bg-amber-50 border-2 border-amber-300/.test(adminSrc));
check('C.5 banner displays the actual server warning text',
  /Server returned: \{loginSummaryWarning\}/.test(adminSrc));

// ---------- D: Build stamp ----------
console.log('\nD. Build stamp current');
check('D.1 header pill v55.61+',
  />v55\.(61|6[2-9]|[7-9]\d)</.test(pageSrc));
var labels = pageSrc.match(/BUILD v55\.\d+-/g);
check('D.2 build modal stamp v55.61+',
  labels && labels.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 61;
  }));

// ---------- E: Earlier session fixes intact ----------
console.log('\nE. Earlier session fixes still intact');
check('E.1 v55.60 NadiaNewBuildCard component still present',
  fs.existsSync(path.join(REPO, 'src/components/NadiaNewBuildCard.jsx')));
check('E.2 v55.59 system_tickets SQL still present',
  fs.existsSync(path.join(REPO, 'supabase/system-tickets-setup.sql')));
check('E.3 v55.58 phone bottom-4 left-4',
  /fixed bottom-4 left-4 w-12 h-12/.test(read('src/components/PhoneWidget.jsx')));
check('E.4 v55.57 ticket double-submit guard',
  /if \(creatingTicket\) return;/.test(read('src/components/TicketsTab.jsx')));
check('E.5 v55.51 customs SQL file present',
  fs.existsSync(path.join(REPO, 'supabase/customs-phase-1.sql')));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate v55.61 online-status fix has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.61 tests passed.\n');
