// ============================================================
// v55.83-KF — Max live P0 batch:
//  (1) CRASH: CustomerLedger used isWithinWindow without importing it → Account Ledger crashed live.
//  (2) AR History: invoice table had NO date sort → default newest-first + clickable toggle.
//  (3) AR History: Paid/Partial/Total-paid pills unreadable → solid high-contrast classes.
//  (4) Bank tab: grouped by parent connection's silo → a moved account showed under the wrong silo.
//      Now grouped by each account's EFFECTIVE silo (account override → connection → unassigned).
//  (5) Match panel: show how much of the deposit is still unallocated (live), before save/approve.
//  (6) Wave categories: inline live diagnostic (silo id + stored counts) + one-click "Pull now".
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var led = rd('src/components/CustomerLedger.jsx');
var ar = rd('src/components/AccountingCustomerHistory.jsx');
var bank = rd('src/components/BankTab.jsx');
var br = rd('src/components/BankReviewTab.jsx');

// (1) crash fix
ok('1: CustomerLedger imports isWithinWindow (was the live crash)',
  /import \{ floorDateFor, labelForWindow, isWithinWindow \} from '\.\.\/lib\/visibility-window'/.test(led));

// (2) AR date sort
ok('2: AR invoice table sorts by date, default newest-first (desc), with a clickable header toggle',
  /var \[invSort, setInvSort\] = useState\('desc'\)/.test(ar) &&
  /onClick=\{function \(\) \{ setInvSort\(invSort === 'desc' \? 'asc' : 'desc'\); \}\}/.test(ar) &&
  /\.slice\(\)\.sort\(function \(a, b\) \{ var da = a\.invoice_date/.test(ar));

// (3) AR pill contrast
ok('3: AR Paid/Partial/Total-paid pills use solid high-contrast classes (readable on dark bg)',
  /label="Paid" v=\{sum\.paidCount\} c="bg-emerald-600 text-white"/.test(ar) &&
  /label="Partial" v=\{sum\.partialCount\} c="bg-amber-500 text-amber-950"/.test(ar) &&
  /label="Total paid" v=\{money\(sum\.totalPaid, showAmt\)\} c="bg-slate-700 text-white"/.test(ar));

// (4) Bank silo grouping by account effective silo
ok('4: Bank tab groups by each ACCOUNT\'s effective silo (override → connection → unassigned)',
  /var effSilo = function \(a, c\) \{ return \(a && a\.wave_business_id\) \|\| \(c && c\.wave_business_id\) \|\| null; \}/.test(bank) &&
  /var acctActive = function \(a, c\) \{ var s = effSilo\(a, c\);/.test(bank) &&
  /var acctOther = function \(a, c\) \{ var s = effSilo\(a, c\);/.test(bank));
ok('5: a connection spanning silos renders only the silo-matching accounts (mode active/other)',
  /var renderConnCard = function \(c, dimmed, mode\)/.test(bank) &&
  /mode === 'other' \? acctOther\(a, c\) : acctActive\(a, c\)/.test(bank) &&
  /renderConnCard\(c, false, 'active'\)/.test(bank) && /renderConnCard\(c, true, 'other'\)/.test(bank));

// (5) remaining-on-deposit warning
ok('6: matched panel shows remaining-unallocated warning live (Max: warn if full amount not accounted for)',
  /of this \{fmt\(dep\)\} deposit is still unallocated/.test(br) && /✓ Fully allocated/.test(br));

// (6) Wave category inline diagnostic + pull
ok('7: Wave category empty-state shows the silo id + stored counts (live diagnostic)',
  /Silo: <b className="text-slate-200">\{getActiveWaveBusiness\(\) \|\| /.test(br) && /stored in Hub: total \{catDiag \? catDiag\.total : 0\}/.test(br));
ok('8: one-click "Pull Wave categories now" calls sync-categories for the silo + reloads + surfaces Wave errors',
  /function pullCategories\(\)/.test(br) &&
  /\/api\/wave\/sync-categories/.test(br) &&
  /Pull Wave categories now/.test(br) &&
  /The configured Wave token likely can\\'t access this Wave business/.test(br));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-KF live-fix tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
