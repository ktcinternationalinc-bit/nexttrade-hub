// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QE — Sidebar regrouped by country (Max, Nov 7 11:19: "There are
// things for the egypt side and usa side and they should not be confused...
// also the open accounts are a separate section"; 12:05: "yes regroup..
// build it now").
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QE — sidebar country regroup');

var pg = R('src/app/page.jsx');
ok('1: 🇺🇸 USA FINANCE = bank + accounting only — nothing Egyptian mixed in',
  /\{ group: '🇺🇸 USA FINANCE', items: \['bank', 'accounting'\] \},/.test(pg));
ok('2: 🇪🇬 EGYPT FINANCE = sales, quotes, treasury, checks, debts, egyptbank',
  /\{ group: '🇪🇬 EGYPT FINANCE', items: \['sales', 'quotes', 'treasury', 'checks', 'debts', 'egyptbank'\] \},/.test(pg));
ok('3: OPEN ACCOUNTS is its OWN section; REPORTS its own row; Operations/People/System untouched',
  /\{ group: 'OPEN ACCOUNTS', items: \['openaccounts'\] \},/.test(pg) &&
  /\{ group: 'REPORTS', items: \['reports'\] \},/.test(pg) &&
  /\{ group: 'OPERATIONS', items: \['warehouse', 'inventory', 'customs', 'shipping'\] \},/.test(pg));
ok('4: every tab still renders through the SAME visibleTabs permission filter (regroup moves rows, never exposes them)',
  /const groupTabs = g\.items\.map\(id => visibleTabs\.find\(t => t\.id === id\)\)\.filter\(Boolean\);/.test(pg));
ok('5: breadcrumbs follow the split — accounting under USA Finance, treasury under Egypt Finance, openaccounts and reports named',
  /accounting:'USA Finance'/.test(pg) && /treasury:'Egypt Finance'/.test(pg) &&
  /openaccounts:'Open Accounts'/.test(pg) && /reports:'Reports'/.test(pg));

console.log('');
console.log('QE: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
