// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PX — Open Balances: sortable columns + ignore-small toggle
//
// Max (Nov 7, 11:07, screenshot of Open Balances): "should be able to sort by
// earliest to latest... and vice versa with how late it is... also should
// have a box to check to ignore under $200 with balances."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PX — open balances sort + small-balance toggle');

var ob = R('src/components/OpenBalancesTab.jsx');
ok('1: click any money/date column to sort, click again to flip (earliest↔latest, most↔least late); default = most days overdue first',
  /useState\('days_overdue'\); var sortKey/.test(ob) &&
  /'Invoice date': 'invoice_date', 'Due date': 'due_date', 'Total': 'total', 'Paid': 'paid', 'Balance due': 'balance_due', 'Days overdue': 'days_overdue'/.test(ob) &&
  /if \(sortKey === k\) \{ setSortDesc\(!sortDesc\); \} else \{ setSortKey\(k\); setSortDesc\(true\); \}/.test(ob) &&
  /sortKey === k \? \(sortDesc \? ' ↓' : ' ↑'\) : ''/.test(ob));
ok('2: "ignore under $200" checkbox hides small balances from the LIST only — they stay open, stay in the card totals, and the hidden count+sum is said out loud',
  /ignore under \$200/.test(ob) && /return !hideSmall \|\| Number\(r\.balance_due\) >= 200;/.test(ob) &&
  /small balance\(s\) under \$200 hidden/.test(ob) && /still open and still counted in the cards above/.test(ob));
ok('3: numeric columns sort numerically (not as text), dates as dates',
  /va = Number\(va\) \|\| 0; vb = Number\(vb\) \|\| 0;/.test(ob));

console.log('');
console.log('PX: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
