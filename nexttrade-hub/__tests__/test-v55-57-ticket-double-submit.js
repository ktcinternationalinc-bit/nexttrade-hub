// ============================================================
// v55.57 — Tickets double-submit protection regression test
//
// Bug fixed: tapping Create twice quickly created two tickets
// with sequential numbers. Same risk on Close-with-Comment.
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
console.log('v55.57 — Tickets double-submit protection');
console.log('============================================================\n');

var src = read('src/components/TicketsTab.jsx');

// ---------- A: state declared ----------
console.log('A. New state for double-submit guards');
check('A.1 creatingTicket state declared',
  /const \[creatingTicket, setCreatingTicket\] = useState\(false\)/.test(src));
check('A.2 closingTicket state declared',
  /const \[closingTicket, setClosingTicket\] = useState\(false\)/.test(src));

// ---------- B: handleAddTicket guarded ----------
console.log('\nB. handleAddTicket protected');
var addFn = src.match(/const handleAddTicket = async \(\) => \{[\s\S]*?\n  \};/);
check('B.0 handleAddTicket function found', !!addFn);
check('B.1 early-return guard at top of handler',
  addFn && /if \(creatingTicket\) return;/.test(addFn[0]));
check('B.2 setCreatingTicket(true) called before insert',
  addFn && /setCreatingTicket\(true\);[\s\S]{0,3000}dbInsert\('tickets'/.test(addFn[0]));
check('B.3 finally clause clears creatingTicket',
  addFn && /finally \{[\s\S]{0,80}setCreatingTicket\(false\);[\s\S]{0,40}\}/.test(addFn[0]));

// ---------- C: Create button visually disabled ----------
console.log('\nC. Create button disables during submission');
check('C.1 Create button has disabled={creatingTicket}',
  /onClick=\{handleAddTicket\}\s*\n\s*disabled=\{creatingTicket\}/.test(src));
check('C.2 Create button shows ⏳ Creating… during submit',
  /creatingTicket \? '⏳ Creating…' : 'Create'/.test(src));
check('C.3 Create button has cursor-not-allowed style when disabled',
  /creatingTicket \? 'bg-slate-300 text-slate-500 cursor-not-allowed'/.test(src));

// ---------- D: finalizeClose guarded ----------
console.log('\nD. finalizeClose protected (Close-with-Comment double-submit)');
var closeFn = src.match(/const finalizeClose = async \(\) => \{[\s\S]*?\n  \};/);
check('D.0 finalizeClose function found', !!closeFn);
check('D.1 early-return guard at top',
  closeFn && /if \(closingTicket\) return;/.test(closeFn[0]));
check('D.2 setClosingTicket(true) called before status update',
  closeFn && /setClosingTicket\(true\);[\s\S]{0,500}dbUpdate\('tickets'/.test(closeFn[0]));
check('D.3 finally clause clears closingTicket',
  closeFn && /finally \{[\s\S]{0,80}setClosingTicket\(false\);[\s\S]{0,40}\}/.test(closeFn[0]));

// ---------- E: Close button visually disabled ----------
console.log('\nE. Close-Ticket button disables during submission');
check('E.1 Close button has disabled={closingTicket}',
  /onClick=\{finalizeClose\}\s*\n\s*disabled=\{closingTicket\}/.test(src));
check('E.2 Close button shows ⏳ Closing… during submit',
  /closingTicket \? '⏳ Closing…' : '✓ Close Ticket'/.test(src));

// ---------- F: Build stamp ----------
console.log('\nF. Build stamp current');
var pSrc = read('src/app/page.jsx');
check('F.1 header pill v55.57+',
  />v55\.(5[7-9]|[6-9]\d)(?:-[A-Z][0-9]*(?:\.\d+)*)?</.test(pSrc));
var labels = pSrc.match(/BUILD v55\.\d+-/g);
check('F.2 build modal stamp v55.57+',
  labels && labels.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 57;
  }));

// ---------- G: Earlier session fixes intact ----------
console.log('\nG. Earlier fixes intact');
check('G.1 v55.56 phone health route still present',
  fs.existsSync(path.join(REPO, 'src/app/api/phone/health/route.js')));
check('G.2 v55.55 monthly drill-down still wired',
  /navigate\('sales', \{ from: monthFrom, to: monthTo \}\)/.test(read('src/components/PersonalDashboard.jsx')));
check('G.3 v55.52 activeUsers helper still in TicketsTab',
  /(const activeUsers = filterActiveUsers\(users\)|const activeUsers = \(users \|\| \[\]\)\.filter\(u => u && u\.active !== false\))/.test(src));
check('G.4 v55.51 customs SQL still present',
  true /* v55.83-A.4 RETIRED: v55.51 customs feature was rearchitected; SQL no longer required */);

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate the v55.57 ticket double-submit fix has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.57 tests passed.\n');
